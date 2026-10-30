
interface Env {
    DB: D1Database;
    AUDIO: R2Bucket;
    FRONTEND_ORIGIN?: string;
}

interface Volunteer {
    id: string;
    active: number;
}

interface AuthResult {
    volunteer: Volunteer | null;
    response?: Response;
}

const MAX_AUDIO_SIZE = 20 * 1024 * 1024;
const PAGE_SIZE_MAX = 100;
const LOCAL_ORIGIN = "http://localhost:5173";

function json(
    data: unknown,
    status = 200,
    headers: HeadersInit = {},
): Response {
    const result = new Headers(headers);
    result.set("Content-Type", "application/json; charset=utf-8");

    return Response.json(data, { status, headers: result });
}

function getCorsHeaders(request: Request, env: Env): Headers {
    const headers = new Headers({
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
    });

    const origin = request.headers.get("Origin");
    const allowedOrigins = [
        LOCAL_ORIGIN,
        env.FRONTEND_ORIGIN,
    ].filter(Boolean);

    if (origin && allowedOrigins.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
    }

    return headers;
}

async function hashAccessKey(key: string): Promise<string> {
    const bytes = new TextEncoder().encode(key);
    const digest = await crypto.subtle.digest("SHA-256", bytes);

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function authenticate(
    request: Request,
    env: Env,
    cors: Headers,
): Promise<AuthResult> {
    const authorization = request.headers.get("Authorization") ?? "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{8,128})$/);

    if (!match) {
        return {
            volunteer: null,
            response: json({ error: "A valid volunteer access key is required." }, 401, cors),
        };
    }

    const keyHash = await hashAccessKey(match[1]);

    const volunteer = await env.DB.prepare(`
    SELECT id, active
    FROM volunteers
    WHERE access_key_hash = ? AND active = 1
  `).bind(keyHash).first<Volunteer>();

    if (!volunteer) {
        return {
            volunteer: null,
            response: json({ error: "Invalid or inactive volunteer key." }, 401, cors),
        };
    }

    return { volunteer };
}

function pagination(url: URL) {
    const page = Math.max(
        1,
        Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
    );

    const pageSize = Math.min(
        PAGE_SIZE_MAX,
        Math.max(
            1,
            Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50,
        ),
    );

    return { page, pageSize, offset: (page - 1) * pageSize };
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const cors = getCorsHeaders(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: cors });
        }

        try {
            if (url.pathname === "/api/health" && request.method === "GET") {
                return json({ status: "ok" }, 200, cors);
            }

            // Exchange a volunteer's access key for their volunteer identity.
            // The frontend must still send the key on subsequent requests.
            if (
                url.pathname === "/api/volunteer/access" &&
                request.method === "POST"
            ) {
                let body: { key?: unknown };

                try {
                    body = await request.json() as { key?: unknown };
                } catch {
                    return json({ error: "A valid JSON body is required." }, 400, cors);
                }

                if (
                    typeof body.key !== "string" ||
                    !/^[A-Za-z0-9_-]{8,128}$/.test(body.key)
                ) {
                    return json({ error: "Enter a valid access key." }, 400, cors);
                }

                const keyHash = await hashAccessKey(body.key);

                const volunteer = await env.DB.prepare(`
          SELECT id
          FROM volunteers
          WHERE access_key_hash = ? AND active = 1
        `).bind(keyHash).first<{ id: string }>();

                if (!volunteer) {
                    return json({ error: "That access key is invalid or inactive." }, 401, cors);
                }

                const counts = await env.DB.prepare(`
          SELECT
            COUNT(*) AS assigned,
            SUM(
              CASE WHEN p.status IN ('submitted', 'published')
              THEN 1 ELSE 0 END
            ) AS completed
          FROM volunteer_assignments a
          LEFT JOIN sentence_progress p
            ON p.sentence_id = a.sentence_id
           AND p.volunteer_id = a.volunteer_id
          WHERE a.volunteer_id = ?
        `).bind(volunteer.id).first<{ assigned: number; completed: number | null }>();

                return json({
                    volunteerId: volunteer.id,
                    assigned: counts?.assigned ?? 0,
                    completed: counts?.completed ?? 0,
                }, 200, cors);
            }

            // Every route below this point requires a valid volunteer key.
            const auth = await authenticate(request, env, cors);

            if (!auth.volunteer) {
                return auth.response!;
            }

            const volunteerId = auth.volunteer.id;

            // Return only sentences assigned to the authenticated volunteer.
            if (url.pathname === "/api/sentences" && request.method === "GET") {
                const { page, pageSize, offset } = pagination(url);

                const result = await env.DB.prepare(`
          SELECT
            se.id,
            se.source_urdu,
            se.position,
            p.status,
            p.submission_id,
            p.submitted_at,
            sub.romanized_memoni
          FROM volunteer_assignments a
          JOIN sentences se ON se.id = a.sentence_id
          LEFT JOIN sentence_progress p
            ON p.sentence_id = se.id
           AND p.volunteer_id = a.volunteer_id
          LEFT JOIN submissions sub
            ON sub.id = p.submission_id
          WHERE a.volunteer_id = ?
          ORDER BY se.position
          LIMIT ? OFFSET ?
        `).bind(volunteerId, pageSize, offset).all();

                const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM volunteer_assignments
          WHERE volunteer_id = ?
        `).bind(volunteerId).first<{ total: number }>();

                const completed = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM sentence_progress
          WHERE volunteer_id = ?
            AND status IN ('submitted', 'published')
        `).bind(volunteerId).first<{ total: number }>();

                return json({
                    sentences: result.results,
                    total: count?.total ?? 0,
                    completed: completed?.total ?? 0,
                    page,
                    pageSize,
                }, 200, cors);
            }

            // Save text and audio only for a sentence assigned to this volunteer.
            if (url.pathname === "/api/submissions" && request.method === "POST") {
                let form: FormData;

                try {
                    form = await request.formData();
                } catch {
                    return json({ error: "A valid multipart form is required." }, 400, cors);
                }

                const sentenceId = Number(form.get("sentenceId"));
                const romanizedMemoni = String(form.get("romanizedMemoni") ?? "").trim();
                const audio = form.get("audio");

                if (!Number.isSafeInteger(sentenceId) || sentenceId <= 0) {
                    return json({ error: "A valid sentenceId is required." }, 400, cors);
                }

                if (!romanizedMemoni || romanizedMemoni.length > 5000) {
                    return json({
                        error: "Memoni text is required and must be at most 5000 characters.",
                    }, 400, cors);
                }

                if (!(audio instanceof File) || audio.size === 0) {
                    return json({ error: "An audio file is required." }, 400, cors);
                }

                if (audio.size > MAX_AUDIO_SIZE) {
                    return json({ error: "Audio must be 20 MB or smaller." }, 413, cors);
                }

                if (!audio.type.startsWith("audio/")) {
                    return json({ error: "The uploaded file must be audio." }, 400, cors);
                }

                const assignment = await env.DB.prepare(`
          SELECT 1
          FROM volunteer_assignments
          WHERE volunteer_id = ? AND sentence_id = ?
        `).bind(volunteerId, sentenceId).first();

                if (!assignment) {
                    return json({
                        error: "This sentence is not assigned to your account.",
                    }, 403, cors);
                }

                const existing = await env.DB.prepare(`
          SELECT status
          FROM sentence_progress
          WHERE sentence_id = ?
        `).bind(sentenceId).first<{ status: string }>();

                if (existing) {
                    return json({
                        error: "This sentence already has a saved submission.",
                        status: existing.status,
                    }, 409, cors);
                }

                const id = crypto.randomUUID();

                const extensionByType: Record<string, string> = {
                    "audio/webm": "webm",
                    "audio/wav": "wav",
                    "audio/x-wav": "wav",
                    "audio/mpeg": "mp3",
                    "audio/mp4": "m4a",
                    "audio/ogg": "ogg",
                    "audio/aac": "aac",
                };

                const baseType = audio.type.split(";")[0].trim().toLowerCase();
                const extension = extensionByType[baseType] ?? "audio";
                const audioKey = `recordings/${id}.${extension}`;

                await env.AUDIO.put(audioKey, audio.stream(), {
                    httpMetadata: {
                        contentType: audio.type || "application/octet-stream",
                    },
                });

                try {
                    // D1 batch executes these statements atomically.
                    await env.DB.batch([
                        env.DB.prepare(`
              INSERT INTO submissions
                (id, sentence_id, contributor_id, romanized_memoni, audio_key)
              VALUES (?, ?, ?, ?, ?)
            `).bind(
                            id,
                            sentenceId,
                            volunteerId,
                            romanizedMemoni,
                            audioKey,
                        ),
                        env.DB.prepare(`
              INSERT INTO sentence_progress
                (sentence_id, volunteer_id, submission_id, status)
              VALUES (?, ?, ?, 'submitted')
            `).bind(sentenceId, volunteerId, id),
                    ]);
                } catch (error) {
                    await env.AUDIO.delete(audioKey);
                    throw error;
                }

                return json({
                    message: "Submission saved successfully.",
                    submission: {
                        id,
                        sentenceId,
                        volunteerId,
                        romanizedMemoni,
                        status: "submitted",
                    },
                }, 201, cors);
            }

            // Update an existing submission without creating a duplicate.
            if (
                url.pathname.startsWith("/api/submissions/") &&
                request.method === "PUT"
            ) {
                const submissionId = url.pathname.slice(
                    "/api/submissions/".length
                );

                if (!submissionId || submissionId.includes("/")) {
                    return json({ error: "Invalid submission ID." }, 400, cors);
                }

                let form: FormData;

                try {
                    form = await request.formData();
                } catch {
                    return json(
                        { error: "A valid multipart form is required." },
                        400,
                        cors
                    );
                }

                const textValue = form.get("romanizedMemoni");
                const romanizedMemoni =
                    typeof textValue === "string" ? textValue.trim() : "";

                const audioValue = form.get("audio");
                const audio = audioValue instanceof File ? audioValue : null;

                if (!romanizedMemoni || romanizedMemoni.length > 5000) {
                    return json(
                        { error: "Memoni text is required and must be at most 5000 characters." },
                        400,
                        cors
                    );
                }

                if (audioValue !== null && !audio) {
                    return json({ error: "Invalid audio file." }, 400, cors);
                }

                if (audio && audio.size === 0) {
                    return json({ error: "The audio file is empty." }, 400, cors);
                }

                if (audio && audio.size > MAX_AUDIO_SIZE) {
                    return json(
                        { error: "Audio must be 20 MB or smaller." },
                        413,
                        cors
                    );
                }

                if (audio && !audio.type.startsWith("audio/")) {
                    return json(
                        { error: "The uploaded file must be audio." },
                        400,
                        cors
                    );
                }

                // Confirm ownership and retrieve the existing recording.
                const existing = await env.DB.prepare(`
                    SELECT
                        s.id,
                        s.sentence_id,
                        s.audio_key,
                        p.status
                    FROM submissions s
                    JOIN volunteer_assignments a
                        ON a.sentence_id = s.sentence_id
                       AND a.volunteer_id = ?
                    JOIN sentence_progress p
                        ON p.submission_id = s.id
                       AND p.sentence_id = s.sentence_id
                       AND p.volunteer_id = ?
                    WHERE s.id = ?
                      AND s.contributor_id = ?
                `).bind(
                    volunteerId,
                    volunteerId,
                    submissionId,
                    volunteerId
                ).first<{
                    id: string;
                    sentence_id: number;
                    audio_key: string;
                    status: string;
                }>();

                if (!existing) {
                    return json(
                        { error: "Submission not found or not accessible." },
                        404,
                        cors
                    );
                }

                // Do not silently modify an already published contribution.
                if (existing.status === "published") {
                    return json(
                        { error: "Published contributions cannot be edited." },
                        409,
                        cors
                    );
                }

                let newAudioKey = existing.audio_key;

                // Only upload a new recording if the volunteer supplied one.
                if (audio) {
                    const extensionByType: Record<string, string> = {
                        "audio/webm": "webm",
                        "audio/wav": "wav",
                        "audio/x-wav": "wav",
                        "audio/mpeg": "mp3",
                        "audio/mp4": "m4a",
                        "audio/ogg": "ogg",
                        "audio/aac": "aac",
                    };

                    const baseType = audio.type
                        .split(";")[0]
                        .trim()
                        .toLowerCase();

                    const extension = extensionByType[baseType] ?? "audio";
                    newAudioKey = `recordings/${crypto.randomUUID()}.${extension}`;

                    await env.AUDIO.put(newAudioKey, audio.stream(), {
                        httpMetadata: {
                            contentType: audio.type || "application/octet-stream",
                        },
                    });
                }

                try {
                    const update = await env.DB.prepare(`
                        UPDATE submissions
                        SET romanized_memoni = ?,
                            audio_key = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                          AND contributor_id = ?
                    `).bind(
                        romanizedMemoni,
                        newAudioKey,
                        submissionId,
                        volunteerId
                    ).run();

                    if (update.meta.changes !== 1) {
                        throw new Error("Submission could not be updated.");
                    }
                } catch (error) {
                    // Remove the newly uploaded recording if the DB update fails.
                    if (audio) {
                        await env.AUDIO.delete(newAudioKey);
                    }
                    throw error;
                }

                // Delete the previous recording only after the DB update succeeds.
                if (audio) {
                    try {
                        await env.AUDIO.delete(existing.audio_key);
                    } catch (error) {
                        console.error("Could not delete previous audio:", error);
                    }
                }

                return json({
                    message: "Submission updated successfully.",
                    submission: {
                        id: existing.id,
                        sentenceId: existing.sentence_id,
                        romanizedMemoni,
                        status: existing.status,
                    },
                }, 200, cors);
            }


            // Return only this volunteer's saved submission metadata.
            if (url.pathname === "/api/submissions" && request.method === "GET") {
                const { page, pageSize, offset } = pagination(url);

                const result = await env.DB.prepare(`
          SELECT
            s.id,
            s.sentence_id,
            s.contributor_id,
            s.romanized_memoni,
            s.audio_key,
            s.created_at,
            se.source_urdu,
            p.status
          FROM submissions s
          JOIN sentences se ON se.id = s.sentence_id
          JOIN volunteer_assignments a
            ON a.sentence_id = s.sentence_id
           AND a.volunteer_id = ?
          LEFT JOIN sentence_progress p
            ON p.submission_id = s.id
          ORDER BY s.created_at DESC
          LIMIT ? OFFSET ?
        `).bind(volunteerId, pageSize, offset).all();

                const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM submissions s
          JOIN volunteer_assignments a
            ON a.sentence_id = s.sentence_id
           AND a.volunteer_id = ?
        `).bind(volunteerId).first<{ total: number }>();

                return json({
                    submissions: result.results,
                    total: count?.total ?? 0,
                    page,
                    pageSize,
                }, 200, cors);
            }

            // Stream audio only if it belongs to a sentence assigned to this volunteer.
            if (url.pathname.startsWith("/api/audio/") && request.method === "GET") {
                const submissionId = url.pathname.slice("/api/audio/".length);

                if (!submissionId || submissionId.includes("/")) {
                    return json({ error: "Invalid submission ID." }, 400, cors);
                }

                const submission = await env.DB.prepare(`
          SELECT s.audio_key
          FROM submissions s
          JOIN volunteer_assignments a
            ON a.sentence_id = s.sentence_id
           AND a.volunteer_id = ?
          WHERE s.id = ?
        `).bind(volunteerId, submissionId).first<{ audio_key: string }>();

                if (!submission) {
                    return json({ error: "Submission not found." }, 404, cors);
                }

                const object = await env.AUDIO.get(submission.audio_key);

                if (!object) {
                    return json({ error: "Audio file not found." }, 404, cors);
                }

                const headers = new Headers(cors);
                headers.set(
                    "Content-Type",
                    object.httpMetadata?.contentType ?? "application/octet-stream",
                );
                headers.set("Cache-Control", "private, no-store");
                headers.set("Content-Length", String(object.size));

                return new Response(object.body, { headers });
            }

            return json({ error: "Endpoint not found." }, 404, cors);
        } catch (error) {
            console.error("API error:", error);

            return json({
                error: "An internal server error occurred.",
            }, 500, cors);
        }
    },
};
