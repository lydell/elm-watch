module DocumentMain exposing (main)

import Browser
import Html
import Html.Events exposing (onClick)
import Shared


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


view : Model -> Browser.Document Msg
view model =
    { title = "Count: " ++ String.fromInt model.count
    , body =
        [ Html.button [ onClick DecrementClicked ]
            [ Html.text Shared.minus ]
        , Html.text (" " ++ String.fromInt model.count ++ " ")
        , Html.button [ onClick IncrementClicked ]
            [ Html.text Shared.plus ]
        ]
    }


main : Program () Model Msg
main =
    Browser.document
        { init = init
        , view = view
        , update = update
        , subscriptions = \_ -> Sub.none
        }
