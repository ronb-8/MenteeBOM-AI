' Launches the given command completely hidden (no console window),
' even when Windows Terminal is the default terminal.
' Usage: wscript.exe run_hidden.vbs <exe> [args...]
Dim sh, cmd, i, a
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
    a = WScript.Arguments(i)
    If InStr(a, " ") > 0 Then a = Chr(34) & a & Chr(34)
    cmd = cmd & a & " "
Next
sh.Run Trim(cmd), 0, False
