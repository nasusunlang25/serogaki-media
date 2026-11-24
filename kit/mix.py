"""声とBGMを合わせて完成mp4にする。
使い方: python3 mix.py video.mp4 voiceDir out.mp4
- 各行のwavをタイミング通りに並べる
- 静かなアンビエントBGMを自作(著作権の心配なし)、声が入ると下がる
- 全体を -14 LUFS に揃える
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np, wave

video, vdir, out = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
tm = json.load(open(vdir / "timing.json"))
T = tm["total"]
SR = 48000

# --- BGM: ゆっくり変わる柔らかいコード(Am - F - C - G)
t = np.arange(int(SR * (T + 1))) / SR
chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 261.63, 329.63], [196.0, 246.94, 293.66]]
bgm = np.zeros_like(t)
seg = 4.0
for i, ch in enumerate(chords * int(T // (seg * 4) + 2)):
    s, e = i * seg, (i + 1) * seg + 1.5
    m = (t >= s) & (t < e)
    if not m.any():
        break
    tt = t[m] - s
    env = np.minimum(1, tt / 1.5) * np.minimum(1, np.maximum(0, (e - s - tt) / 1.5))
    for f in ch:
        bgm[m] += env * (np.sin(2 * np.pi * f * t[m]) + 0.3 * np.sin(2 * np.pi * f * 2 * t[m] + 0.5)) / 3
# きらめき(高い音を時々)
rng = np.random.default_rng(7)
for s in np.arange(1.0, T, 2.7):
    f = rng.choice([659.25, 783.99, 880.0, 987.77])
    m = (t >= s) & (t < s + 2.5)
    tt = t[m] - s
    bgm[m] += 0.18 * np.exp(-tt * 1.8) * np.sin(2 * np.pi * f * t[m])
bgm *= 0.085 / (np.abs(bgm).max() + 1e-9)
fade = np.minimum(1, t / 1.0) * np.minimum(1, np.maximum(0, (T - t) / 1.2))
bgm *= fade
pcm = (np.clip(bgm, -1, 1) * 32767).astype(np.int16)
with wave.open(str(vdir / "bgm.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# --- 声を並べる
inputs, filt = [], []
for i, l in enumerate(tm["lines"]):
    inputs += ["-i", str(vdir / l["file"])]
    d = int(l["s"] * 1000)
    filt.append(f"[{i}:a]aresample={SR},adelay={d}|{d}[v{i}]")
n = len(tm["lines"])
filt.append("".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,apad=whole_dur={T}[voice]")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[voice]", "-t", str(T), str(vdir / "voice.wav")], check=True)

# --- ミックス: 声でBGMを下げる → ラウドネス調整 → 映像と合わせる
fc = ("[1:a]asplit=2[vo][sc];[2:a]volume=0.9[b];"
      "[b][sc]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=400[bd];"
      "[vo][bd]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[a]")
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", video, "-i", str(vdir / "voice.wav"), "-i", str(vdir / "bgm.wav"),
                "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
                "-t", f"{T:.3f}", "-movflags", "+faststart", out], check=True)
print("done", out)

# --- 2回目: 実測して -14 LUFS ちょうどに合わせる
import re, shutil
r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", out, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", r)[-1])
tmp = out + ".tmp.mp4"
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", out, "-af", f"volume={-14 - I:.2f}dB,alimiter=limit=0.89",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp], check=True)
shutil.move(tmp, out)
print(f"loudness {I:.1f} -> -14")
