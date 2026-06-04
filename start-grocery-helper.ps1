$node = "C:\Users\David Cochran\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$app = Join-Path $PSScriptRoot "server.js"

& $node $app
