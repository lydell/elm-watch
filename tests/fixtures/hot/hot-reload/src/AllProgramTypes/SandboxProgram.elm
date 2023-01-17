module AllProgramTypes.SandboxProgram exposing (main)

import Browser
import Html
import AllProgramTypes


main =
    Browser.sandbox
        { init = ()
        , view = always (Html.p [] [ Html.text ("SandboxProgram" ++ AllProgramTypes.suffix) ])
        , update = always identity
        }
