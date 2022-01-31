port module PortChange1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes
import Html.Events


port toJs : String -> Cmd msg


port fromJs : (Int -> msg) -> Sub msg


type Msg
    = OriginalFromJs Int
    | NewFromJs Int
    | NoOp


type alias Model =
    { originalFromJs : List Int
    , newFromJs : List Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { originalFromJs = []
      , newFromJs = []
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OriginalFromJs int ->
            let
                newValue =
                    int :: model.originalFromJs
            in
            ( { model | originalFromJs = newValue }
            , toJs ("Before hot reload: " ++ fromJsToString newValue)
            )

        NewFromJs int ->
            let
                newValue =
                    int :: model.newFromJs
            in
            ( { model | newFromJs = newValue }
            , toJs ("Before: " ++ fromJsToString model.originalFromJs ++ ". After hot reload: " ++ fromJsToString newValue)
            )

        NoOp ->
            ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions model =
    fromJs OriginalFromJs


fromJsToString : List Int -> String
fromJsToString list =
    let
        content =
            list |> List.reverse |> List.map String.fromInt |> String.join ", "
    in
    "[" ++ content ++ "]"


viewDocument : Model -> Browser.Document Msg
viewDocument model =
    { title = "Title"
    , body = [ view model ]
    }


view : Model -> Html Msg
view _ =
    Html.text ""


mainElement : Program () Model Msg
mainElement =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }


mainDocument : Program () Model Msg
mainDocument =
    Browser.document
        { init = init
        , view = viewDocument
        , update = update
        , subscriptions = subscriptions
        }


mainApplication : Program () Model Msg
mainApplication =
    Browser.application
        { init = \flags _ _ -> init flags
        , view = viewDocument
        , update = update
        , subscriptions = subscriptions
        , onUrlRequest = always NoOp
        , onUrlChange = always NoOp
        }


mainWorker : Program () Model Msg
mainWorker =
    Platform.worker
        { init = init
        , update = update
        , subscriptions = subscriptions
        }


main : Program () Model Msg
main =
    mainElement
