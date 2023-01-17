module AddPortUsedInUpdate1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events



-- port toJs : String -> Cmd msg


init : () -> ( (), Cmd () )
init () =
    ( (), Cmd.none )


update : () -> () -> ( (), Cmd () )
update () model =
    ( model
    , Cmd.batch
        [ Cmd.none

        -- , toJs "sent in update!"
        ]
    )


view : () -> Html ()
view () =
    Html.main_
        [-- Html.Events.onClick ()
        ]
        [ Html.text "main" ]


main : Program () () ()
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = view
        }
