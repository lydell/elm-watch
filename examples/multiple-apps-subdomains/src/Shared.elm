module Shared exposing (Model, Msg, document, init, onUrlChange, onUrlRequest, update)

{-| Code shared between the two apps: Navigation and layout.
-}

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes as Attr
import Url exposing (Url)


type App
    = MainApp
    | AdminApp


type Msg
    = UrlRequested Browser.UrlRequest
    | UrlChanged Url


type alias Model =
    { key : Nav.Key
    , url : Url
    }


init : Url -> Nav.Key -> Model
init url key =
    { key = key
    , url = url
    }


onUrlRequest : Browser.UrlRequest -> Msg
onUrlRequest =
    UrlRequested


onUrlChange : Url -> Msg
onUrlChange =
    UrlChanged


{-| Both apps are `Browser.application` programs, each owning all URLs on their
own host. Links to the _other_ app go to another host, so Elm treats them as
external links, which results in a full page load.
-}
update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        UrlRequested (Browser.Internal url) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        UrlRequested (Browser.External href) ->
            ( model, Nav.load href )

        UrlChanged url ->
            ( { model | url = url }, Cmd.none )


{-| The admin app is on the same host as the main app, but with `admin.` in
front: `localhost` and `admin.localhost` in development, and for example
`example.com` and `admin.example.com` in production.
-}
linkTo : App -> String -> Url -> String
linkTo app path url =
    let
        mainHost =
            if String.startsWith "admin." url.host then
                String.dropLeft (String.length "admin.") url.host

            else
                url.host

        host =
            case app of
                MainApp ->
                    mainHost

                AdminApp ->
                    "admin." ++ mainHost
    in
    Url.toString { url | host = host, path = path, query = Nothing, fragment = Nothing }


document : String -> Model -> List (Html msg) -> Browser.Document msg
document title model content =
    let
        link app path text =
            Html.a [ Attr.href (linkTo app path model.url) ] [ Html.text text ]
    in
    { title = title
    , body =
        [ Html.nav []
            [ link MainApp "/" "Home"
            , Html.text " | "
            , link MainApp "/about" "About"
            , Html.text " | "
            , link AdminApp "/" "Admin"
            , Html.text " | "
            , link AdminApp "/users" "Admin users"
            ]
        , Html.main_ []
            (Html.h1 [] [ Html.text title ]
                :: Html.p [] [ Html.text ("Current URL: " ++ Url.toString model.url) ]
                :: content
            )
        ]
    }
