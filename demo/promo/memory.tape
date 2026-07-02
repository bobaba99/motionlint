# MotionLint cross-run memory demo — annotate, dedup, baseline.
# Render: vhs demo/promo/memory.tape  (demo server on :4173, memory primed by prior runs)
Output .motionlint/promo/motionlint-memory.mp4

Set Shell "bash"
Set FontSize 18
Set Width 1920
Set Height 1080
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WaitTimeout 240s

Sleep 1s
Type "# MotionLint remembers: re-runs mark what it already told you"
Enter
Sleep 500ms
Type "motionlint review http://localhost:4173 -v desktop --max-findings 5"
Sleep 800ms
Enter
Wait+Screen@240s /Score:/
Sleep 8s
Type "clear"
Enter
Type "# iterating? only surface what's new since prior runs"
Enter
Sleep 500ms
Type "motionlint review http://localhost:4173 -v desktop --new-only"
Sleep 800ms
Enter
Wait+Screen@240s /Score:/
Sleep 8s
Type "# wave a finding off for good: put its id in .motionlintignore"
Enter
Sleep 500ms
Type "echo '55d4b10a1314e27f  empty testimonials — content lands next sprint' >> .motionlintignore"
Sleep 500ms
Enter
Sleep 4s
