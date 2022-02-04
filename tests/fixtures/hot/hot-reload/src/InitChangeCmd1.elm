module InitChangeCmd1 exposing (main)

import Browser
import Html exposing (Html)



-- port toJs : String -> Cmd msg


type alias Model =
    String


init : () -> ( Model, Cmd () )
init () =
    ( "init"
    , Cmd.batch
        [ Cmd.none

        -- , toJs "sent on init!"
        ]
    )


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = Html.text
        }
