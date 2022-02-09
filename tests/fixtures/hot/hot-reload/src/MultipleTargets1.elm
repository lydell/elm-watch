module MultipleTargets1 exposing (Msg(..), main)

import Browser
import Html


type Msg
    = RenameMe


main : Program () () Msg
main =
    Browser.element
        { init = always ( (), Cmd.none )
        , update = \_ () -> ( (), Cmd.none )
        , view = always (Html.text "text")
        , subscriptions = always Sub.none
        }
