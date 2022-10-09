module DocumentMain exposing (main)

import Browser
import Html
import Html.Attributes as Attr
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


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Browser.Document Msg
view model =
    { title = "Awesome counter app"
    , body =
        [ Html.div []
            [ Html.button [ onClick DecrementClicked ]
                [ Html.text Shared.minus ]
            , Html.text (" " ++ String.fromInt model.count ++ " ")
            , Html.button [ onClick IncrementClicked ]
                [ Html.text Shared.plus ]
            , Html.p
                [ Attr.style "position" "fixed"
                , Attr.style "top" "0"
                , Attr.style "right" "0"
                , Attr.style "background" "red"
                , Attr.style "z-index" "2147483647"
                ]
                [ Html.text "position: fixed with maximum z-index – should be covered by the error overlay" ]
            ]
        ]
    }


main : Program () Model Msg
main =
    Browser.document
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }
