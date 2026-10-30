
from pathlib import Path
from datasets import load_dataset
import shutil

DATASET_ID = "sara0123456789/GenAI-Urdu-Dataset"
BATCH_SIZE = 100

output_dir = Path("seed-sql")
if output_dir.exists():
    shutil.rmtree(output_dir)
output_dir.mkdir(parents=True)

print(f"Loading {DATASET_ID}...")
dataset = load_dataset(DATASET_ID, split="train")

print("Available columns:", dataset.column_names)

if "output" not in dataset.column_names:
    raise ValueError("The dataset has no 'output' column.")

def sql_quote(value):
    return "'" + value.replace("'", "''") + "'"

statements = []
position = 0

for row in dataset:
    sentence = row["output"]

    if not isinstance(sentence, str) or not sentence.strip():
        continue

    sentence = sentence.strip()
    position += 1

    statements.append(
        "INSERT OR IGNORE INTO sentences "
        "(source_urdu, position) VALUES "
        f"({sql_quote(sentence)}, {position});"
    )

for batch_number, start in enumerate(
    range(0, len(statements), BATCH_SIZE), start=1
):
    batch = statements[start:start + BATCH_SIZE]
    sql_file = output_dir / f"batch_{batch_number:03d}.sql"
    sql_file.write_text("\n".join(batch) + "\n", encoding="utf-8")

print(f"Prepared {position} sentences.")
print(f"Created {(len(statements) + BATCH_SIZE - 1) // BATCH_SIZE} SQL batches.")
print(f"Files are in: {output_dir}/")
