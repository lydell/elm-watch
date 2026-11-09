module ApplicationMain exposing (main)

import Browser
import Browser.Navigation as Nav
import Html
import Html.Attributes as Attr
import Url exposing (Url)


type Msg
    = UrlRequested Browser.UrlRequest
    | UrlChanged Url


type alias Model =
    { key : Nav.Key
    , url : Url
    }


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , url = url
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        UrlRequested (Browser.Internal url) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        UrlRequested (Browser.External href) ->
            ( model, Nav.load href )

        UrlChanged url ->
            ( { model | url = url }, Cmd.none )


view : Model -> Browser.Document Msg
view model =
    { title = model.url.path
    , body =
        [ Html.nav []
            [ Html.a [ Attr.href "/" ] [ Html.text "Home" ]
            , Html.text " | "
            , Html.a [ Attr.href "/about" ] [ Html.text "About" ]
            ]
        , Html.p [] [ Html.text ("Current path: " ++ model.url.path) ]
        ]
    }


main : Program () Model Msg
main =
    Browser.application
        { init = init
        , view = view
        , update = update
        , subscriptions = \_ -> Sub.none
        , onUrlRequest = UrlRequested
        , onUrlChange = UrlChanged
        }
