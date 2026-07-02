# MotionLint flow demo — animation review of a scripted user journey.
# Render: vhs demo/promo/flow.tape  (demo server on :4173, ANTHROPIC_API_KEY set)
Output .motionlint/promo/motionlint-flow.mp4

Set Shell "bash"
Set FontSize 18
Set Width 1920
Set Height 1080
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WaitTimeout 300s

Sleep 1s
Type "# animation review: drive a real user flow, burst-capture every interaction"
Enter
Sleep 500ms
Type "motionlint flow --spec flows/signup.json"
Sleep 800ms
Enter
Wait+Screen@300s /report/
Sleep 8s
