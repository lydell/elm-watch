module InitTweakValue1 exposing (main)

import Browser
import Html exposing (Html)


type alias Model =
    String


init : () -> ( Model, Cmd () )
init () =
    ( "init"
      -- ++ "_tweaked"
    , Cmd.none
    )


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , view = Html.text
        }
