port module Main exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events exposing (onClick)


{-| Handled in TypeScript, which uses an npm package to show confetti.
-}
port celebrate : Int -> Cmd msg


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
            let
                count =
                    model.count + 1
            in
            ( { model | count = count }
            , if modBy 5 count == 0 then
                celebrate count

              else
                Cmd.none
            )

        DecrementClicked ->
            ( { model | count = model.count - 1 }, Cmd.none )


view : Model -> Html Msg
view model =
    Html.div [ Attr.class "counter" ]
        [ Html.button [ onClick DecrementClicked ]
            [ Html.text "-" ]
        , Html.text (" " ++ String.fromInt model.count ++ " ")
        , Html.button [ onClick IncrementClicked ]
            [ Html.text "+" ]
        , Html.p [] [ Html.text "Every fifth click is celebrated." ]
        ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = \_ -> Sub.none
        }
