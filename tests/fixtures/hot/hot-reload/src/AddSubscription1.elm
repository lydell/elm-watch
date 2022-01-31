module AddSubscription1 exposing (main)

-- import Browser.Events
-- import Json.Decode as Decode

import Browser
import Html exposing (Html)
import Html.Attributes
import Html.Events


type Msg
    = Clicked Int
    | NoOp


type alias Model =
    Int


init : () -> ( Model, Cmd Msg )
init () =
    ( 0
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Clicked delta ->
            ( model + delta, Cmd.none )

        NoOp ->
            ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    -- Browser.Events.onClick (Decode.succeed (Clicked 10))
    Sub.none


viewDocument : Model -> Browser.Document Msg
viewDocument model =
    { title = "Title"
    , body = [ view model ]
    }


view : Model -> Html Msg
view model =
    Html.main_ [ Html.Events.onClick (Clicked -1) ]
        [ Html.text (String.fromInt model)
        ]


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
    mainElement
