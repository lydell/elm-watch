module InitHttp1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events
import Http
import Task


type alias Model =
    Int


type Msg
    = Increment
    | HttpDone (Result Http.Error ())


init : () -> ( Model, Cmd Msg )
init () =
    ( 0
    , Http.task
        { method = "GET"
        , headers = []
        , url = "/"
        , body = Http.emptyBody
        , resolver = Http.stringResolver (\_ -> Ok ())
        , timeout = Nothing
        }
        |> Task.attempt HttpDone
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            ( model + 1, Cmd.none )

        HttpDone _ ->
            ( model, Cmd.none )


view : Model -> Html Msg
view model =
    Html.button [ Html.Events.onClick Increment ]
        [ Html.text ("Count: " ++ String.fromInt model) ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = view
        }
