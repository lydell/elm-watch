module AddPortUsedInSubscriptions1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events



-- port fromJs : (Int -> msg) -> Sub msg


type alias Model =
    Int


type Msg
    = FromJs Int


init : () -> ( Model, Cmd Msg )
init () =
    ( 0, Cmd.none )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg _ =
    case msg of
        FromJs int ->
            ( int, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ Sub.none

        -- , fromJs FromJs
        ]


view : Model -> Html Msg
view model =
    Html.main_ [] [ Html.text (String.fromInt model) ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
