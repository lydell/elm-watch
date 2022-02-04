module ChangeProgramType2 exposing (main)

import Browser
import Html exposing (Html)


main : Program () () ()
main =
    Browser.element
        { init = always ( (), Cmd.none )
        , update = \() () -> ( (), Cmd.none )
        , subscriptions = always Sub.none
        , view = always (Html.text "Browser.element")
        }
