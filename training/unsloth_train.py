"""Phase 5.3 local fine-tune: Qwen2.5-1.5B-Instruct + LoRA on RTX 3050 4GB.

Unsloth 4-bit QLoRA fits ~3GB VRAM. Trains on training/data/combined.jsonl
(approvals export + augmented bootstrap), validates on the held-out split,
saves merged fp16 + Q4_K_M GGUF for Ollama.

Run inside WSL2 Ubuntu with the user-space env:
    python3 training/unsloth_train.py
"""

import json
import os
import sys

REPO = "/mnt/d/MyDesktop/SIMPLIFYR_2_Backup_2/SIMPLIFYR_2"
DATA = os.path.join(REPO, "training", "data", "combined.jsonl")
OUT = os.path.join(REPO, "training", "out")

MODEL_NAME = "unsloth/Qwen2.5-1.5B-Instruct-bnb-4bit"
MAX_SEQ_LEN = 1024
LORA_R = 16
EPOCHS = 3
BATCH = 2
GRAD_ACCUM = 4


def main() -> None:
    from datasets import Dataset
    from unsloth import FastLanguageModel
    from trl import SFTTrainer, SFTConfig

    rows = [json.loads(line) for line in open(DATA, encoding="utf-8") if line.strip()]
    train_rows = [r for r in rows if r.get("meta", {}).get("split", "train") == "train"]
    val_rows = [r for r in rows if r.get("meta", {}).get("split") == "val"]
    print(f"train={len(train_rows)} val={len(val_rows)}", flush=True)

    alpaca = (
        "Below is an instruction. Write a response.\n\n"
        "### Instruction:\n{}\n\n### Input:\n{}\n\n### Response:\n{}"
    )

    def fmt(r):
        return {
            "text": alpaca.format(r["instruction"], r["input"], r["output"]),
        }

    train_ds = Dataset.from_list([fmt(r) for r in train_rows])
    val_ds = Dataset.from_list([fmt(r) for r in val_rows])

    model, tokenizer = FastLanguageModel.from_pretrained(
        MODEL_NAME,
        max_seq_length=MAX_SEQ_LEN,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=LORA_R,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=20260923,
        max_seq_length=MAX_SEQ_LEN,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        args=SFTConfig(
            dataset_text_field="text",
            per_device_train_batch_size=BATCH,
            gradient_accumulation_steps=GRAD_ACCUM,
            num_train_epochs=EPOCHS,
            logging_steps=25,
            eval_strategy="epoch",
            save_strategy="epoch",
            output_dir=os.path.join(OUT, "checkpoints"),
            report_to="none",
            seed=20260923,
        ),
    )
    trainer.train()
    print("training done; saving", flush=True)

    model.save_pretrained(os.path.join(OUT, "simplifyr-1.5b-lora"))
    tokenizer.save_pretrained(os.path.join(OUT, "simplifyr-1.5b-lora"))
    model.save_pretrained_gguf(os.path.join(OUT, "gguf"), tokenizer, quantization_method="q4_k_m")
    print("SAVED ALL", flush=True)


if __name__ == "__main__":
    sys.exit(main())
