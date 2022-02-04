module ChangeProgramType1 exposing (main)

import Browser
import Html exposing (Html)


main : Program () () ()
main =
    Browser.sandbox
        { init = ()
        , update = \() () -> ()
        , view = always (Html.text "Browser.sandbox")
        }
