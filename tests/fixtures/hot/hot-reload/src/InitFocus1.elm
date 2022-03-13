module InitFocus1 exposing (main)

import Browser
import Browser.Dom
import Html exposing (Html)
import Html.Attributes
import Html.Events
import Task


type alias Model =
    Int


type Msg
    = Increment
    | NoOp


id =
    "id"


init : () -> ( Model, Cmd Msg )
init () =
    ( 0
    , Browser.Dom.focus id |> Task.attempt (always NoOp)
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            ( model + 1, Cmd.none )

        NoOp ->
            ( model, Cmd.none )


view : Model -> Html Msg
view model =
    Html.button
        [ Html.Attributes.id id
        , Html.Events.onClick Increment
        ]
        [ Html.text ("Count: " ++ String.fromInt model) ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = view
        }
