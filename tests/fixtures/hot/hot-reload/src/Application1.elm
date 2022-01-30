module Application1 exposing (main)

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes
import Html.Events
import Url exposing (Url)


type Msg
    = PushUrlButtonClicked
    | OriginalUrlRequested Browser.UrlRequest
    | OriginalUrlChanged Url
    | NewUrlRequested Browser.UrlRequest
    | NewUrlChanged Url


type alias Model =
    { key : Nav.Key
    , url : Url
    , originalUrlRequested : Int
    , originalUrlChanged : Int
    , newUrlRequested : Int
    , newUrlChanged : Int
    }


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , url = url
      , originalUrlRequested = 0
      , originalUrlChanged = 0
      , newUrlRequested = 0
      , newUrlChanged = 0
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        PushUrlButtonClicked ->
            ( model, Nav.pushUrl model.key "/push" )

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


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none


view : Model -> Browser.Document Msg
view model =
    { title = "Application"
    , body =
        [ Html.main_ []
            [ Html.h1 [ Html.Attributes.class "probe" ] [ Html.text "Before hot reload" ]
            , Html.a [ Html.Attributes.href "/link" ] [ Html.text "Link" ]
            , Html.button [ Html.Events.onClick PushUrlButtonClicked ] [ Html.text "Button" ]
            , Html.pre [] [ Html.text ("\n" ++ modelToString model ++ "\n") ]
            ]
        ]
    }


modelToString : Model -> String
modelToString model =
    [ ( "url", Url.toString model.url )
    , ( "originalUrlRequested", String.fromInt model.originalUrlRequested )
    , ( "originalUrlChanged", String.fromInt model.originalUrlChanged )
    , ( "newUrlRequested", String.fromInt model.newUrlRequested )
    , ( "newUrlChanged", String.fromInt model.newUrlChanged )
    ]
        |> List.map (\( key, value ) -> key ++ ": " ++ value)
        |> String.join "\n"


main : Program () Model Msg
main =
    Browser.application
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        , onUrlRequest = OriginalUrlRequested
        , onUrlChange = OriginalUrlChanged
        }
