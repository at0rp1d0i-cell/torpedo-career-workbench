#!/usr/bin/env bash
# 构建简历 PDF：稳定双页框架 + 分页正文 → Chrome 无头渲染（A4）
# 用法（在仓库根执行；正文参数相对本目录或绝对路径）：
#   bash resume/build.sh                                      # 标准版
#   bash resume/build.sh resume-content.html 推理Infra        # 指定正文与变体名
#   bash resume/build.sh --photo                              # 照片版
#   bash resume/build.sh --photo 推理Infra                    # 指定照片版变体名
# 依赖：macOS + Google Chrome（系统自带 Songti SC）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRAME="$ROOT/resume.html"

if [ "${1:-}" = "--photo" ]; then
  CONTENT="$ROOT/resume-content.html"
  VARIANT="${2:-推理Infra}"
  MODE="photo"
else
  CONTENT="${1:-$ROOT/resume-content.html}"
  VARIANT="${2:-推理Infra}"
  MODE="${3:-standard}"
fi

case "$CONTENT" in
  /*) ;;
  *) CONTENT="$ROOT/$CONTENT" ;;
esac
[ -f "$FRAME" ] || { echo "✗ 找不到页面框架：$FRAME"; exit 1; }
[ -f "$CONTENT" ] || { echo "✗ 找不到正文文件：$CONTENT"; exit 1; }

case "$MODE" in
  standard|photo) ;;
  *) echo "✗ 未知构建模式：${MODE}（可用 standard / photo）"; exit 1 ;;
esac
[ "$MODE" != "photo" ] || [ -f "$ROOT/assets/my_photo.jpg" ] || {
  echo "✗ 找不到照片：$ROOT/assets/my_photo.jpg"; exit 1;
}

# 定位 Chrome
CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome 2>/dev/null || true)" ; do
  [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
done
[ -z "$CHROME" ] && { echo "✗ 找不到 Chrome/Chromium"; exit 1; }

OUT_DIR="$ROOT/dist"
mkdir -p "$OUT_DIR"

TMP_FILES=()
CHROME_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/torpedo-career-workbench-chrome.XXXXXX")"
CHROME_FLAGS=(--headless=new --disable-gpu --no-first-run --no-default-browser-check "--user-data-dir=$CHROME_PROFILE")
CHROME_TIMEOUT="$(command -v timeout || command -v gtimeout || true)"
CHROME_RUN=()
[ -z "$CHROME_TIMEOUT" ] || CHROME_RUN=("$CHROME_TIMEOUT" 25s)
cleanup() {
  [ ${#TMP_FILES[@]} -eq 0 ] || rm -f "${TMP_FILES[@]}"
  python3 - "$CHROME_PROFILE" <<'PY'
from pathlib import Path
import shutil
import sys

profile = Path(sys.argv[1])
if profile.name.startswith("torpedo-career-workbench-chrome.") and profile.is_dir():
    shutil.rmtree(profile)
PY
}
trap cleanup EXIT

PAGE_1="$ROOT/.resume-page-1.tmp.html"
PAGE_2="$ROOT/.resume-page-2.tmp.html"
ASSEMBLED="$ROOT/.resume-assembled.tmp.html"
TMP_FILES+=("$PAGE_1" "$PAGE_2" "$ASSEMBLED")

perl -0e '
  my ($source, $page1, $page2) = @ARGV;
  open my $in, "<", $source or die "无法读取正文：$source: $!\n";
  local $/;
  my $content = <$in>;
  my ($first, $second) = split(/<!-- PAGE 2 -->/, $content, 2);
  die "正文必须包含唯一的 <!-- PAGE 2 --> 分页标记\n" unless defined $second;
  die "正文包含多个 <!-- PAGE 2 --> 分页标记\n" if $second =~ /<!-- PAGE 2 -->/;
  open my $out1, ">", $page1 or die "无法写入第一页正文：$!\n";
  open my $out2, ">", $page2 or die "无法写入第二页正文：$!\n";
  print {$out1} $first;
  print {$out2} $second;
' "$CONTENT" "$PAGE_1" "$PAGE_2"

perl -0e '
  my ($frame, $page1, $page2) = @ARGV;
  sub slurp {
    my ($path) = @_;
    open my $fh, "<", $path or die "无法读取 $path: $!\n";
    local $/;
    return <$fh>;
  }
  my $html = slurp($frame);
  $html =~ s/\{\{PAGE_1\}\}/slurp($page1)/e or die "框架缺少 {{PAGE_1}} 插槽\n";
  $html =~ s/\{\{PAGE_2\}\}/slurp($page2)/e or die "框架缺少 {{PAGE_2}} 插槽\n";
  die "框架仍包含未替换的正文插槽\n" if $html =~ /\{\{PAGE_[12]\}\}/;
  print $html;
' "$FRAME" "$PAGE_1" "$PAGE_2" > "$ASSEMBLED"

if [ "$MODE" = "photo" ]; then
  INPUT="$ROOT/.resume-photo.tmp.html"
  TMP_FILES+=("$INPUT")
  perl -0pe 's/<body>/<body class="with-photo">/' "$ASSEMBLED" > "$INPUT"
else
  INPUT="$ASSEMBLED"
fi

# 框架内置布局探针：正文超出任一固定 sheet 时，构建失败而不是静默裁切。
DOM="$("${CHROME_RUN[@]}" "$CHROME" "${CHROME_FLAGS[@]}" --dump-dom "file://$INPUT" 2>/dev/null || true)"
if printf '%s' "$DOM" | perl -0e '
  my $dom = <>;
  exit 1 if $dom =~ /data-layout-fit="overflow"/;
  exit 0 if $dom =~ /data-layout-fit="ok"/;
  exit 2;
'; then
  echo "✓ 双页正文均在固定内容范围内"
else
  STATUS=$?
  [ "$STATUS" -eq 1 ] && { echo "✗ 正文超出固定页面内容范围"; exit 1; }
  echo "✗ 无法读取页面布局探针"; exit 1
fi

STAMP="$(date +%Y-%m)"
if [ "$MODE" = "photo" ]; then
  LABEL="正式版-照片"
  LATEST="$OUT_DIR/${RESUME_NAME:-示例候选人}-简历-latest-照片.pdf"
else
  LABEL="正式版"
  LATEST="$OUT_DIR/${RESUME_NAME:-示例候选人}-简历-latest.pdf"
fi
OUT="$OUT_DIR/${RESUME_NAME:-示例候选人}-简历-${VARIANT}-${LABEL}-${STAMP}.pdf"
rm -f "$OUT" "$LATEST"

"${CHROME_RUN[@]}" "$CHROME" "${CHROME_FLAGS[@]}" --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$INPUT" >/dev/null 2>&1 || true
[ -s "$OUT" ] || { echo "✗ Chrome 未生成 PDF"; exit 1; }
if command -v pdfinfo >/dev/null 2>&1; then
  pdfinfo "$OUT" >/dev/null 2>&1 || { echo "✗ Chrome 生成的 PDF 无法读取"; exit 1; }
fi

cp "$OUT" "$LATEST"

echo "✓ 已构建${LABEL}：$OUT"
echo "  最新版本：$LATEST"
echo "  归档已发版本请 cp 到仓库根的 releases/ 并在 CHANGELOG.md 记录"
