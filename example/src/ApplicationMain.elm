module ApplicationMain exposing (main)

import Browser
import Browser.Navigation as Nav
import Html exposing (Html)
import Html.Attributes as Attr
import Url exposing (Url)
import Url.Builder
import Url.Parser


type Msg
    = UrlRequested Browser.UrlRequest
    | UrlChanged Url


type alias Model =
    { key : Nav.Key
    , maybePage : MaybePage
    }


type MaybePage
    = Page Page
    | NotFound


type Page
    = Home
    | About


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init () url key =
    ( { key = key
      , maybePage = pageFromUrl url
      }
    , Cmd.none
    )


pageFromUrl : Url -> MaybePage
pageFromUrl url =
    Url.Parser.parse urlParser url
        |> Maybe.map Page
        |> Maybe.withDefault NotFound


urlFromPage : Page -> String
urlFromPage page =
    case page of
        Home ->
            Url.Builder.absolute [] []

        About ->
            Url.Builder.absolute [ "about" ] []


urlParser : Url.Parser.Parser (Page -> b) b
urlParser =
    Url.Parser.oneOf
        [ Url.Parser.map Home Url.Parser.top
        , Url.Parser.map About (Url.Parser.s "about")
        ]


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        UrlRequested urlRequest ->
            case urlRequest of
                Browser.Internal url ->
                    ( model, Nav.pushUrl model.key (Url.toString url) )

                Browser.External href ->
                    ( model, Nav.load href )

        UrlChanged url ->
            ( { model | maybePage = pageFromUrl url }
            , Cmd.none
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none


view : Model -> Browser.Document Msg
view model =
    case model.maybePage of
        Page Home ->
            viewPage "Home"
                model.maybePage
                (Html.p []
                    [ Html.text "This the home page!" ]
                )

        Page About ->
            viewPage "About"
                model.maybePage
                (Html.p []
                    [ Html.text "This the about us page!" ]
                )

        NotFound ->
            viewPage "404"
                model.maybePage
                (Html.p []
                    [ Html.text "Not found" ]
                )


viewPage : String -> MaybePage -> Html Msg -> Browser.Document Msg
viewPage title maybePage content =
    { title = title ++ " – Awesome site"
    , body =
        [ viewNav maybePage
        , Html.hr [] []
        , content
        ]
    }


viewNav : MaybePage -> Html Msg
viewNav maybePage =
    let
        items =
            [ ( Home, "Home" )
            , ( About, "About" )
            ]
    in
    Html.nav []
        [ Html.ul []
            (items
                |> List.map
                    (\( page, text ) ->
                        Html.li []
                            [ Html.a
                                (if Page page == maybePage then
                                    []

                                 else
                                    [ Attr.href (urlFromPage page)
                                    ]
                                )
                                [ Html.text text ]
                            ]
                    )
            )
        ]


main : Program () Model Msg
main =
    Browser.application
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        , onUrlRequest = UrlRequested
        , onUrlChange = UrlChanged
        }
