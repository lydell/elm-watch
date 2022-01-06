port module Application2 exposing (main)

import Browser
import Browser.Events
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes
import Html.Events
import Json.Decode as Decode
import Url exposing (Url)


port toJs : Int -> Cmd msg


port fromJs : (Int -> msg) -> Sub msg


port terminate : (() -> msg) -> Sub msg


type Msg
    = PushUrlButtonClicked
    | BrowserOnClick
    | OriginalFromJs Int
    | OriginalUrlRequested Browser.UrlRequest
    | OriginalUrlChanged Url
    | NewFromJs Int
    | NewUrlRequested Browser.UrlRequest
    | NewUrlChanged Url
    | Terminate


type alias Model =
    { key : Nav.Key
    , url : Url
    , originalUrlRequested : Int
    , originalUrlChanged : Int
    , newUrlRequested : Int
    , newUrlChanged : Int
    , browserOnClick : Int
    , originalFromJs : List Int
    , newFromJs : List Int
    , terminated : Bool
    }


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , url = url
      , originalUrlRequested = 0
      , originalUrlChanged = 0
      , newUrlRequested = 0
      , newUrlChanged = 0
      , browserOnClick = 0
      , originalFromJs = []
      , newFromJs = []
      , terminated = False
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        PushUrlButtonClicked ->
            ( model, Nav.pushUrl model.key "/push" )

        BrowserOnClick ->
            ( { model | browserOnClick = model.browserOnClick + 1 }, Cmd.none )

        OriginalFromJs int ->
            ( { model | originalFromJs = int :: model.originalFromJs }, toJs (int * 2) )

        OriginalUrlRequested urlRequest ->
            case urlRequest of
                Browser.Internal url ->
                    ( { model | originalUrlRequested = model.originalUrlRequested + 1 }
                    , Nav.pushUrl model.key (Url.toString url)
                    )

                Browser.External href ->
                    ( model, Nav.load href )

        OriginalUrlChanged url ->
            ( { model | url = url, originalUrlChanged = model.originalUrlChanged + 1 }
            , Cmd.none
            )

        NewFromJs int ->
            ( { model | newFromJs = int :: model.newFromJs }, toJs (int * 4) )

        NewUrlRequested urlRequest ->
            case urlRequest of
                Browser.Internal url ->
                    ( { model | newUrlRequested = model.newUrlRequested + 1 }
                    , Nav.pushUrl model.key (Url.toString url)
                    )

                Browser.External href ->
                    ( model, Nav.load href )

        NewUrlChanged url ->
            ( { model | url = url, newUrlChanged = model.newUrlChanged + 1 }
            , Cmd.none
            )

        Terminate ->
            ( { model | terminated = True }, Nav.pushUrl model.key "/" )


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.terminated then
        Sub.none

    else
        Sub.batch
            [ fromJs NewFromJs
            , terminate (\() -> Terminate)
            , Browser.Events.onClick (Decode.succeed BrowserOnClick)
            ]


view : Model -> Browser.Document Msg
view model =
    { title = "Application"
    , body =
        [ Html.div []
            [ Html.h1 [ Html.Attributes.class "probe" ] [ Html.text "After hot reload" ]
            , Html.a [ Html.Attributes.href "/link" ] [ Html.text "Link" ]
            , Html.button [ Html.Events.onClick PushUrlButtonClicked ] [ Html.text "Button" ]
            , Html.pre [] [ Html.text ("\n" ++ modelToString model ++ "\n") ]
            ]
        ]
    }


modelToString : Model -> String
modelToString model =
    [ ( "url", Url.toString model.url )
    , ( "originalFromJs", fromJsToString model.originalFromJs )
    , ( "originalUrlRequested", String.fromInt model.originalUrlRequested )
    , ( "originalUrlChanged", String.fromInt model.originalUrlChanged )
    , ( "newFromJs", fromJsToString model.newFromJs )
    , ( "newUrlRequested", String.fromInt model.newUrlRequested )
    , ( "newUrlChanged", String.fromInt model.newUrlChanged )
    , ( "browserOnClick", String.fromInt model.browserOnClick )
    ]
        |> List.map (\( key, value ) -> key ++ ": " ++ value)
        |> String.join "\n"


fromJsToString : List Int -> String
fromJsToString list =
    let
        content =
            list |> List.map String.fromInt |> String.join ", "
    in
    "[" ++ content ++ "]"


main : Program () Model Msg
main =
    Browser.application
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        , onUrlRequest = NewUrlRequested
        , onUrlChange = NewUrlChanged
        }
