module Main exposing (main)

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode
import Url exposing (Url)


type Page
    = Home
    | Time
    | NotFound


type TimeState
    = NotAsked
    | Loading
    | Loaded String
    | Failed Http.Error


type Msg
    = UrlRequested Browser.UrlRequest
    | UrlChanged Url
    | FetchTimeClicked
    | GotTime (Result Http.Error String)


type alias Model =
    { key : Nav.Key
    , page : Page
    , time : TimeState
    }


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , page = urlToPage url
      , time = NotAsked
      }
    , Cmd.none
    )


urlToPage : Url -> Page
urlToPage url =
    case url.path of
        "/" ->
            Home

        "/time" ->
            Time

        _ ->
            NotFound


fetchTime : Cmd Msg
fetchTime =
    Http.get
        { url = "/api/time"
        , expect = Http.expectJson GotTime (Decode.field "time" Decode.string)
        }


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        UrlRequested (Browser.Internal url) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        UrlRequested (Browser.External href) ->
            ( model, Nav.load href )

        UrlChanged url ->
            ( { model | page = urlToPage url }, Cmd.none )

        FetchTimeClicked ->
            ( { model | time = Loading }, fetchTime )

        GotTime result ->
            case result of
                Ok time ->
                    ( { model | time = Loaded time }, Cmd.none )

                Err error ->
                    ( { model | time = Failed error }, Cmd.none )


view : Model -> Browser.Document Msg
view model =
    { title = "example-application-proxy"
    , body =
        [ Html.nav []
            [ Html.a [ Attr.href "/" ] [ Html.text "Home" ]
            , Html.text " | "
            , Html.a [ Attr.href "/time" ] [ Html.text "Time" ]
            ]
        , Html.main_ [] (viewPage model)
        ]
    }


viewPage : Model -> List (Html Msg)
viewPage model =
    case model.page of
        Home ->
            [ Html.h1 [] [ Html.text "Home" ]
            , Html.p [] [ Html.text "Go to the Time page, and then try reloading the page." ]
            ]

        Time ->
            [ Html.h1 [] [ Html.text "Time" ]
            , Html.p []
                [ Html.button [ onClick FetchTimeClicked ] [ Html.text "Ask the backend for the time" ] ]
            , Html.p [] [ viewTime model.time ]
            ]

        NotFound ->
            [ Html.h1 [] [ Html.text "Page not found" ] ]


viewTime : TimeState -> Html msg
viewTime time =
    case time of
        NotAsked ->
            Html.text ""

        Loading ->
            Html.text "Loading…"

        Loaded string ->
            Html.text ("The backend says: " ++ string)

        Failed error ->
            Html.text ("Error: " ++ httpErrorToString error)


httpErrorToString : Http.Error -> String
httpErrorToString error =
    case error of
        Http.BadUrl url ->
            "Bad URL: " ++ url

        Http.Timeout ->
            "Timeout"

        Http.NetworkError ->
            "Network error"

        Http.BadStatus status ->
            "Bad status: " ++ String.fromInt status ++ " (is the backend running?)"

        Http.BadBody body ->
            "Bad body: " ++ body


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
