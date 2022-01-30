module DomAndMsgChange1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes
import Html.Events


type Msg
    = OriginalButtonClicked
    | NewButtonClicked
    | NoOp


type alias Model =
    { originalButtonClicked : Int
    , newButtonClicked : Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { originalButtonClicked = 0
      , newButtonClicked = 0
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OriginalButtonClicked ->
            ( { model | originalButtonClicked = model.originalButtonClicked + 1 }, Cmd.none )

        NewButtonClicked ->
            ( { model | newButtonClicked = model.newButtonClicked + 1 }, Cmd.none )

        NoOp ->
            ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


viewDocument : Model -> Browser.Document Msg
viewDocument model =
    { title = "Title"
    , body = [ view model ]
    }


view : Model -> Html Msg
view model =
    Html.main_ []
        [ Html.h1 [ Html.Attributes.class "probe" ] [ Html.text "Before hot reload" ]
        , Html.button [ Html.Events.onClick OriginalButtonClicked ] [ Html.text "Button" ]
        , Html.pre [] [ Html.text ("\n" ++ modelToString model ++ "\n") ]
        ]


modelToString : Model -> String
modelToString model =
    [ ( "originalButtonClicked", String.fromInt model.originalButtonClicked )
    , ( "newButtonClicked", String.fromInt model.newButtonClicked )
    ]
        |> List.map (\( key, value ) -> key ++ ": " ++ value)
        |> String.join "\n"


mainSandbox : Program () Model Msg
mainSandbox =
    Browser.sandbox
        { init = init () |> Tuple.first
        , view = view
        , update = \msg model -> update msg model |> Tuple.first
        }


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


main : Program () Model Msg
main =
    mainSandbox
