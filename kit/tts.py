"""セロガキ用 VOICEVOX(青山龍星)音声生成。

使い方: python3 tts.py script.json outdir
script.json: {"style": 13, "speed": 1.12, "lines": ["一行目", "二行目", ...]}
出力: outdir/line_XX.wav と outdir/timing.json(各行の開始・終了秒、全体の長さ)
"""
import json, os, sys, wave, io
from pathlib import Path
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile

VV = Path(os.environ.get("VV_DIR", "/home/claude/vv"))
GAP = 0.28  # 行と行のあいだの間(秒)


def main(script_path, outdir):
    spec = json.load(open(script_path, encoding="utf-8"))
    style = spec.get("style", 13)
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    ort = Onnxruntime.load_once(filename=str(next(VV.glob("voicevox_onnxruntime-linux-x64-*/lib/libvoicevox_onnxruntime.so*"))))
    syn = Synthesizer(ort, OpenJtalk(str(VV / "open_jtalk_dic_utf_8-1.11")))
    with VoiceModelFile.open(str(VV / "15.vvm")) as m:
        syn.load_voice_model(m)
    t, lines = 0.0, []
    for i, ln in enumerate(spec["lines"]):
        text = ln["text"] if isinstance(ln, dict) else ln
        q = syn.create_audio_query(text, style)
        q.speed_scale = spec.get("speed", 1.12)
        q.pre_phoneme_length = 0.05
        q.post_phoneme_length = 0.05
        wav = syn.synthesis(q, style)
        p = out / f"line_{i:02d}.wav"
        p.write_bytes(wav)
        with wave.open(io.BytesIO(wav)) as w:
            d = w.getnframes() / w.getframerate()
        lines.append({"i": i, "text": text, "s": round(t, 3), "e": round(t + d, 3), "file": p.name})
        t += d + GAP
    json.dump({"lines": lines, "total": round(t - GAP + 0.6, 3)}, open(out / "timing.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(lines)} lines, {t:.2f}s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
