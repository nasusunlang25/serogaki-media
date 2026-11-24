#!/bin/bash
# 作業環境に VOICEVOX(青山龍星)と描画ライブラリを入れる。毎回の自動実行の最初に1回だけ。
set -e
VV=${VV_DIR:-/home/claude/vv}; mkdir -p "$VV"; cd "$VV"
G=https://github.com/VOICEVOX
[ -f voicevox_core-0.16.0-cp310-abi3-manylinux_2_34_x86_64.whl ] || curl -sSLO $G/voicevox_core/releases/download/0.16.0/voicevox_core-0.16.0-cp310-abi3-manylinux_2_34_x86_64.whl
pip install --break-system-packages -q voicevox_core-0.16.0-cp310-abi3-manylinux_2_34_x86_64.whl
[ -d voicevox_onnxruntime-linux-x64-1.17.3 ] || (curl -sSL -o ort.tgz $G/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-linux-x64-1.17.3.tgz && tar xzf ort.tgz)
[ -d open_jtalk_dic_utf_8-1.11 ] || (curl -sSL -o dic.tgz https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz && tar xzf dic.tgz)
[ -f 15.vvm ] || curl -sSLO $G/voicevox_vvm/releases/download/0.16.0/15.vvm
cd "$(dirname "$0")" && npm install --silent
echo setup ok
