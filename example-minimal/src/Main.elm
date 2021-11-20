module Main exposing (main)

import Browser
import Html exposing (Html)
import Html.Events exposing (onClick)


type Msg
    = IncrementClicked
    | DecrementClicked


type alias Model =
    { count : Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        IncrementClicked ->
            ( { model | count = model.count + 1 }, Cmd.none )

        DecrementClicked ->
            ( { model | count = model.count - 1 }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Html Msg
view model =
    Html.div []
        [ Html.button [ onClick DecrementClicked ]
            [ Html.text "-" ]
        , Html.text (" " ++ String.fromInt model.count ++ " ")
        , Html.button [ onClick IncrementClicked ]
            [ Html.text "+" ]
        ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }
