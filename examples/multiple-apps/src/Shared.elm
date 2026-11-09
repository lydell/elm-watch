module Shared exposing (Model, Msg, document, init, onUrlChange, onUrlRequest, update)

{-| Code shared between the two apps: Navigation and layout.
-}

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes as Attr
import Url exposing (Url)


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


{-| Both apps are `Browser.application` programs, each owning their own URLs.
The admin app owns `/admin` and everything below it, and the main app owns
everything else. Links to the _other_ app need a full page load, so that the
other app’s `index.html` (and Elm code) is loaded.
-}
update : (String -> Bool) -> Msg -> Model -> ( Model, Cmd Msg )
update ownsPath msg model =
    case msg of
        UrlRequested (Browser.Internal url) ->
            if ownsPath url.path then
                ( model, Nav.pushUrl model.key (Url.toString url) )

            else
                ( model, Nav.load (Url.toString url) )

        UrlRequested (Browser.External href) ->
            ( model, Nav.load href )

        UrlChanged url ->
            ( { model | url = url }, Cmd.none )


document : String -> Model -> List (Html msg) -> Browser.Document msg
document title model content =
    { title = title
    , body =
        [ Html.nav []
            [ Html.a [ Attr.href "/" ] [ Html.text "Home" ]
            , Html.text " | "
            , Html.a [ Attr.href "/about" ] [ Html.text "About" ]
            , Html.text " | "
            , Html.a [ Attr.href "/admin" ] [ Html.text "Admin" ]
            , Html.text " | "
            , Html.a [ Attr.href "/admin/users" ] [ Html.text "Admin users" ]
            ]
        , Html.main_ []
            (Html.h1 [] [ Html.text title ]
                :: Html.p [] [ Html.text ("Current path: " ++ model.url.path) ]
                :: content
            )
        ]
    }
