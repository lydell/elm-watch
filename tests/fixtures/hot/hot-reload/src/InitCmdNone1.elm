module InitCmdNone1 exposing (main)

import Browser
import Html exposing (Html)
import Task


type alias Model =
    String


type Msg
    = InitCmdDone -- unused


init : () -> ( Model, Cmd Msg )
init () =
    ( "init"
      -- This file is identical to `InitCmds1.elm`, except that we return `Cmd.none` here:
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        InitCmdDone ->
            ( "Model set via Cmd from OLD code"
            , Cmd.none
            )


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = Html.text
        }
