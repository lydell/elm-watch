module MultipleTargetsOther1 exposing (main)

import Browser
import Html
import MultipleTargets exposing (Msg)


main : Program () () Msg
main =
    Browser.element
        { init = always ( (), Cmd.none )
        , update = \_ () -> ( (), Cmd.none )
        , view = always (Html.text "text")
        , subscriptions = always Sub.none
        }
