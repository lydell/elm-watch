module Main exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Translations exposing (Language)


type Msg
    = IncrementClicked
    | DecrementClicked
    | LanguageClicked Language


type alias Model =
    { count : Int
    , language : Language
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      , language = Translations.defaultLanguage
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        IncrementClicked ->
            ( { model | count = model.count + 1 }, Cmd.none )

        DecrementClicked ->
            ( { model | count = model.count - 1 }, Cmd.none )

        LanguageClicked language ->
            ( { model | language = language }, Cmd.none )


view : Model -> Html Msg
view model =
    let
        t =
            Translations.translations model.language
    in
    Html.div []
        [ Html.h1 [] [ Html.text t.title ]
        , Html.p []
            [ Html.button [ onClick DecrementClicked ]
                [ Html.text t.decrement ]
            , Html.text (" " ++ String.fromInt model.count ++ " ")
            , Html.button [ onClick IncrementClicked ]
                [ Html.text t.increment ]
            ]
        , Html.p []
            (Html.text (t.language ++ ": ")
                :: List.map (viewLanguageButton model.language) Translations.languages
            )
        ]


viewLanguageButton : Language -> Language -> Html Msg
viewLanguageButton current language =
    Html.button
        [ onClick (LanguageClicked language)
        , Attr.disabled (language == current)
        ]
        [ Html.text (Translations.languageName language) ]


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = \_ -> Sub.none
        }
