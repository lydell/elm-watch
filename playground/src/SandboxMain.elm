module SandboxMain exposing (main)

import Browser
import Html exposing (Html)
import Html.Events exposing (onClick)
import Shared


type Msg
    = IncrementClicked
    | DecrementClicked


type alias Model =
    { count : Int
    }


init : Model
init =
    { count = 0
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        IncrementClicked ->
            { model | count = model.count + 1 }

        DecrementClicked ->
            { model | count = model.count - 1 }


view : Model -> Html Msg
view model =
    Html.div []
        [ Html.button [ onClick DecrementClicked ]
            [ Html.text Shared.minus ]
        , Html.text (" " ++ String.fromInt model.count ++ " ")
        , Html.button [ onClick IncrementClicked ]
            [ Html.text Shared.plus ]
        ]


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , view = view
        , update = update
        }
