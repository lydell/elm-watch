module FlagsChange1 exposing (main)

import Browser
import Html exposing (Html)


type alias Flags =
    { one : String

    -- , two : Int
    }


type alias Model =
    String


init : Flags -> ( Model, Cmd () )
init flags =
    ( flags.one
      -- ++ " " ++ String.fromInt flags.two
    , Cmd.none
    )


main : Program Flags Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = Html.text
        }
