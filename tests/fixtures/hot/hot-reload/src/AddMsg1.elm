module AddMsg1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events


type alias Model =
    String


type Msg
    = Msg1 -- | AddedMsg


init : () -> ( Model, Cmd Msg )
init () =
    ( "init"
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        -- AddedMsg ->
        --     ( "AddedMsg", Cmd.none )
        Msg1 ->
            ( "Msg1", Cmd.none )


view : Model -> Html Msg
view model =
    Html.main_
        [ Html.Events.onClick Msg1

        -- , Html.Events.onClick AddedMsg
        ]
        [ Html.text model ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = view
        }
