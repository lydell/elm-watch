module DebugLog exposing (main)

import Html

main =
  Html.text (Debug.log "Text" "Hello, log!")
