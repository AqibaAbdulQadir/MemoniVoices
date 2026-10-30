const API_URL = import.meta.env.VITE_API_URL || "";

export interface Sentence {
    id: number;
    source_urdu: string;
    position: number;
}

export interface SentenceResponse {
    sentences: Sentence[];
    total: number;
    page: number;
    pageSize: number;
}

export async function fetchSentences(
    page = 1,
    pageSize = 50
): Promise<SentenceResponse> {
    const response = await fetch(
        `${API_URL}/api/sentences?page=${page}&pageSize=${pageSize}`
    );

    if (!response.ok) {
        throw new Error(`Failed to load sentences (${response.status})`);
    }

    return response.json();
}