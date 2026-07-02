# MotionLint hero demo — AI design review in your terminal.
# Render: vhs demo/promo/review.tape  (demo server on :4173, ANTHROPIC_API_KEY set)
Output .motionlint/promo/motionlint-review.mp4

Set Shell "bash"
Set FontSize 18
Set Width 1920
Set Height 1080
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WaitTimeout 240s

Sleep 1s
Type "# AI design review in your terminal — real vision-LLM, top 5 findings"
Enter
Sleep 500ms
Type "motionlint review http://localhost:4173 -v desktop --max-findings 5"
Sleep 800ms
Enter
Wait+Screen@240s /Score:/
Sleep 12s
