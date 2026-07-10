#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate speech with Hume MLX-TADA on Apple Silicon.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--reference-audio", required=True)
    parser.add_argument("--reference-text", default=None)
    parser.add_argument("--model", default=os.environ.get("TADA_MODEL", "HumeAI/mlx-tada-1b"),
                        help="Model name (HumeAI/mlx-tada-1b | HumeAI/mlx-tada-3b) or local path.")
    parser.add_argument("--weights", default=None)
    parser.add_argument("--tokenizer", default=None)
    parser.add_argument("--quantize", type=int, choices=[4, 8], default=None)
    parser.add_argument("--reference-cache", default=None)
    # InferenceOptions — match official CLI defaults
    parser.add_argument("--acoustic-cfg", type=float, default=1.6,
                        help="Classifier-free guidance scale for acoustic features.")
    parser.add_argument("--flow-steps", type=int, default=10,
                        help="Number of Euler steps in the diffusion ODE solver (10 = README recommendation; 20 = default).")
    parser.add_argument("--noise-temp", type=float, default=0.9,
                        help="Scale of initial noise for flow matching.")
    parser.add_argument("--text-temp", type=float, default=0.6,
                        help="Controls randomness of text token sampling.")
    parser.add_argument("--cfg-schedule", choices=['constant', 'linear', 'cosine'], default='cosine',
                        help="CFG schedule over the flow steps (cosine = README recommendation).")
    parser.add_argument("--time-schedule", choices=['uniform', 'cosine', 'logsnr'], default='logsnr',
                        help="Time-step schedule for the diffusion (logsnr = README recommendation).")
    parser.add_argument("--num-extra-steps", type=int, default=50,
                        help="Generate extra acoustic tokens after text ends for natural trailing (README: 50). 0 = abrupt cut.")
    parser.add_argument("--num-transition-steps", type=int, default=5,
                        help="Reference frames to regenerate at the reference→generated boundary (default 5).")
    parser.add_argument("--text-repetition-penalty", type=float, default=1.1,
                        help="Repetition penalty for text token sampling (default 1.1).")
    args = parser.parse_args()

    try:
        from transformers import AutoTokenizer
        from mlx_tada import InferenceOptions, Reference, TadaForCausalLM, save_wav
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"MLX-TADA runtime import failed: {exc}"}))
        return 1

    reference_audio = Path(args.reference_audio).expanduser().resolve()
    if not reference_audio.exists():
        print(json.dumps({"ok": False, "error": f"Reference audio not found: {reference_audio}"}))
        return 1

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cache_path = Path(args.reference_cache).expanduser().resolve() if args.reference_cache else None
    weights = args.weights or args.model
    tokenizer_override = args.tokenizer or os.environ.get("TADA_TOKENIZER")

    original_from_pretrained = AutoTokenizer.from_pretrained
    if tokenizer_override:
        resolved_tokenizer = str(Path(tokenizer_override).expanduser().resolve())

        def patched_from_pretrained(name_or_path, *extra_args, **extra_kwargs):
            if name_or_path == "meta-llama/Llama-3.2-1B":
                name_or_path = resolved_tokenizer
            return original_from_pretrained(name_or_path, *extra_args, **extra_kwargs)

        AutoTokenizer.from_pretrained = patched_from_pretrained

    try:
        if args.weights and Path(args.weights).expanduser().exists():
            model = TadaForCausalLM.from_weights(str(Path(args.weights).expanduser().resolve()), quantize=args.quantize)
            model_source = str(Path(args.weights).expanduser().resolve())
        elif Path(weights).expanduser().exists():
            model = TadaForCausalLM.from_weights(str(Path(weights).expanduser().resolve()), quantize=args.quantize)
            model_source = str(Path(weights).expanduser().resolve())
        else:
            model = TadaForCausalLM.from_pretrained(weights, quantize=args.quantize)
            model_source = weights

        # Load or encode reference — if no --reference-text, mlx-whisper auto-transcribes
        if cache_path and cache_path.exists():
            reference = Reference.load(str(cache_path))
        else:
            reference = model.load_reference(str(reference_audio), args.reference_text or None)
            if cache_path:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                reference.save(str(cache_path))

        opts = InferenceOptions(
            text_temperature=args.text_temp,
            text_repetition_penalty=args.text_repetition_penalty,
            acoustic_cfg_scale=args.acoustic_cfg,
            num_flow_matching_steps=args.flow_steps,
            noise_temperature=args.noise_temp,
            cfg_schedule=args.cfg_schedule,
            time_schedule=args.time_schedule,
        )

        result = model.generate(
            args.text,
            reference,
            inference_options=opts,
            num_transition_steps=args.num_transition_steps,
            num_extra_steps=args.num_extra_steps,
        )
        save_wav(result.audio, str(output_path))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    print(json.dumps({
        "ok": True,
        "output": str(output_path),
        "model": model_source,
        "quantize": args.quantize,
        "tokenizer": tokenizer_override,
        "referenceAudio": str(reference_audio),
        "referenceCache": str(cache_path) if cache_path else None,
        "inference": {
            "acoustic_cfg": args.acoustic_cfg,
            "flow_steps": args.flow_steps,
            "noise_temp": args.noise_temp,
            "text_temp": args.text_temp,
            "cfg_schedule": args.cfg_schedule,
            "time_schedule": args.time_schedule,
            "num_extra_steps": args.num_extra_steps,
            "num_transition_steps": args.num_transition_steps,
            "text_repetition_penalty": args.text_repetition_penalty,
        },
        "audio": {
            "duration": result.duration,
            "num_tokens": result.num_tokens,
            "rtf": result.rtf,
        },
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
