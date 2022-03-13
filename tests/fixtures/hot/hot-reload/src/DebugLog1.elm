module DebugLog1 exposing (main)

import Html


main =
    if True then
        Html.text "True"

    else
        Html.text (Debug.log "text" "False")
