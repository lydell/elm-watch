module ProxyMergeOther1 exposing (main)

import Browser
import Html


main : Program () () ()
main =
    Browser.element
        { init = \() -> ( (), Cmd.none )
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = \() -> Html.text "ProxyMergeOther works"
        }
