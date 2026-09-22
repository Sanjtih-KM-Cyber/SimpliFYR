"""Phase 5.3 local fine-tune WITHOUT Unsloth (Windows/WSL friendly).

Plain HuggingFace stack (works with torch 2.5.1+cu121 on the RTX 3050 4GB):
transformers + bitsandbytes 4-bit QLoRA + peft + transformers Trainer.

Trains Qwen2.5-1.5B-Instruct on training/data/combined.jsonl, merges the
adapter, and saves fp16 for GGUF conversion (llama.cpp) + Ollama.

Run inside WSL2 Ubuntu user env:
    python3 training/train_hf.py
"""

import json
import os

REPO = "/mnt/d/MyDesktop/SIMPLIFYR_2_Backup_2/SIMPLIFYR_2"
DATA = os.path.join(REPO, "training", "data", "combined.jsonl")
OUT = os.path.join(REPO, "training", "out")

MODEL_NAME = os.environ.get("MODEL_DIR", "Qwen/Qwen2.5-1.5B-Instruct")
MAX_SEQ_LEN = 1024
EPOCHS = 3


def main() -> None:
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        DataCollatorForLanguageModeling,
        Trainer,
        TrainingArguments,
    )

    rows = [json.loads(line) for line in open(DATA, encoding="utf-8") if line.strip()]
    train_rows = [r for r in rows if r.get("meta", {}).get("split", "train") == "train"]
    val_rows = [r for r in rows if r.get("meta", {}).get("split") == "val"]
    print(f"train={len(train_rows)} val={len(val_rows)}", flush=True)

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    def fmt(r):
        return (
            "Below is an instruction. Write a response.\n\n"
            f"### Instruction:\n{r['instruction']}\n\n"
            f"### Input:\n{r['input']}\n\n"
            f"### Response:\n{r['output']}"
        )

    def tokenize(batch):
        texts = [fmt(r) for r in batch["rows"]]
        toks = tokenizer(texts, truncation=True, max_length=MAX_SEQ_LEN)
        # Mask everything before the response so loss focuses on the mapping.
        labels = []
        for text, ids in zip(texts, toks["input_ids"]):
            marker = "### Response:\n"
            cut = text.index(marker) + len(marker)
            n_prompt = len(tokenizer(text[:cut], add_special_tokens=False)["input_ids"])
            labels.append([-100] * min(n_prompt, len(ids)) + ids[min(n_prompt, len(ids)):])
        toks["labels"] = labels
        return toks

    train_ds = Dataset.from_list([{"rows": r} for r in train_rows])
    val_ds = Dataset.from_list([{"rows": r} for r in val_rows])
    cols_in = train_ds.column_names
    train_ds = train_ds.map(lambda b: tokenize(b), batched=True, batch_size=64,
                            remove_columns=cols_in)
    val_ds = val_ds.map(lambda b: tokenize(b), batched=True, batch_size=64,
                        remove_columns=cols_in)

    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, quantization_config=bnb, device_map="auto", trust_remote_code=True
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(
        model,
        LoraConfig(
            r=16, lora_alpha=16, lora_dropout=0.05, bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                            "gate_proj", "up_proj", "down_proj"],
        ),
    )
    model.print_trainable_parameters()

    args = TrainingArguments(
        output_dir=os.path.join(OUT, "checkpoints"),
        per_device_train_batch_size=2,
        per_device_eval_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=EPOCHS,
        learning_rate=2e-4,
        bf16=True,
        logging_steps=25,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        report_to="none",
        seed=20260923,
        gradient_checkpointing=True,
        optim="paged_adamw_8bit",
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    trainer.train()
    print("training done; merging", flush=True)

    merged = model.merge_and_unload()
    merged.save_pretrained(os.path.join(OUT, "simplifyr-1.5b-fp16"))
    tokenizer.save_pretrained(os.path.join(OUT, "simplifyr-1.5b-fp16"))
    print("SAVED ALL", flush=True)


if __name__ == "__main__":
    main()
