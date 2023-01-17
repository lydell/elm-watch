module AllProgramTypes.SandboxProgram exposing (main)

import AllProgramTypes
import Browser
import Html


main =
    Browser.sandbox
        { init = ()
        , view = always (Html.p [] [ Html.text ("SandboxProgram" ++ AllProgramTypes.suffix) ])
        , update = always identity
        }
