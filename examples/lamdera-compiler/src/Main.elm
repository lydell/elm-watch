module Main exposing (main)

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Url exposing (Url)


type Page
    = Home
    | About
    | NotFound


type Msg
    = UrlRequested Browser.UrlRequest
    | UrlChanged Url
    | IncrementClicked


type alias Model =
    { key : Nav.Key
    , page : Page
    , count : Int
    }


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , page = urlToPage url
      , count = 0
      }
    , Cmd.none
    )


urlToPage : Url -> Page
urlToPage url =
    case url.path of
        "/" ->
            Home

        "/about" ->
            About

        _ ->
            NotFound


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        UrlRequested (Browser.Internal url) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        UrlRequested (Browser.External href) ->
            ( model, Nav.load href )

        UrlChanged url ->
            ( { model | page = urlToPage url }, Cmd.none )

        IncrementClicked ->
            ( { model | count = model.count + 1 }, Cmd.none )


view : Model -> Browser.Document Msg
view model =
    { title = "Lamdera compiler example"
    , body =
        [ Html.nav []
            [ Html.a [ Attr.href "/" ] [ Html.text "Home" ]
            , Html.text " · "
            , Html.a [ Attr.href "/about" ] [ Html.text "About" ]
            ]
        , Html.main_ [] (viewPage model.page)
        , Html.p []
            [ Html.button [ onClick IncrementClicked ] [ Html.text "Increment" ]
            , Html.text (" Count: " ++ String.fromInt model.count)
            ]
        ]
    }


viewPage : Page -> List (Html Msg)
viewPage page =
    case page of
        Home ->
            [ Html.h1 [] [ Html.text "Home" ]
            , Html.p [] [ Html.text "This vanilla Elm app is compiled with the Lamdera compiler. Edit this text and save!" ]
            ]

        About ->
            [ Html.h1 [] [ Html.text "About" ]
            , Html.p [] [ Html.text "The count is kept when hot reloading, and the links keep working afterwards." ]
            ]

        NotFound ->
            [ Html.h1 [] [ Html.text "Not found" ] ]


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
