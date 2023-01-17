module InitChangeCmd1 exposing (main)

import Browser
import Html exposing (Html)



-- port toJs : String -> Cmd msg


init : () -> ( (), Cmd () )
init () =
    ( ()
    , Cmd.batch
        [ Cmd.none

        -- , toJs "sent on init!"
        ]
    )


main : Program () () ()
main =
    Browser.element
        { init = init
        , update = \() () -> ( (), Cmd.none )
        , subscriptions = \() -> Sub.none
        , view = \() -> Html.text ""
        }
