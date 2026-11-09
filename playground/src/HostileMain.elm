port module HostileMain exposing (main)

{-| A page that tries hard to mess with elm-watch’s browser UI. See
public/Hostile.html and public/hostile.css.
-}

import Browser
import Browser.Events
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Json.Decode as Decode


port openModalDialog : () -> Cmd msg


type Msg
    = OpenModalDialogClicked
    | PressedKey String


type alias Model =
    { lastPressedKeys : List String
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { lastPressedKeys = []
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OpenModalDialogClicked ->
            ( model, openModalDialog () )

        PressedKey key ->
            ( { model | lastPressedKeys = List.take 10 (key :: model.lastPressedKeys) }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Browser.Events.onKeyDown (Decode.field "key" Decode.string |> Decode.map PressedKey)


view : Model -> Browser.Document Msg
view model =
    { title = "Hostile"
    , body =
        [ Html.main_ []
            [ Html.h1 [] [ Html.text "Hostile page" ]
            , Html.p [] [ Html.text "This page has lots of styles (see hostile.css) and elements that could mess with elm-watch’s UI. None of it should affect the elm-watch UI. Check the toggle button, the panel, and the error overlay (make a compile error in HostileMain.elm)." ]
            , Html.h2 [] [ Html.text "Top layer" ]
            , Html.p [] [ Html.text "The error overlay should cover all of these." ]
            , Html.p []
                [ Html.button [ Attr.attribute "popovertarget" "popover" ]
                    [ Html.text "Open popover" ]
                , Html.text " "
                , Html.button [ onClick OpenModalDialogClicked ]
                    [ Html.text "Open modal dialog" ]
                ]
            , Html.div [ Attr.attribute "popover" "auto", Attr.id "popover" ]
                [ Html.text "Popover" ]
            , Html.node "dialog"
                [ Attr.id "dialog" ]
                [ Html.p [] [ Html.text "Modal dialog. Everything outside is inert – elm-watch should show that it can’t be used right now." ]
                , Html.form [ Attr.method "dialog" ] [ Html.button [] [ Html.text "Close" ] ]
                ]
            , Html.p [ Attr.class "fixed-max-z-index" ]
                [ Html.text "position: fixed with maximum z-index" ]
            , Html.h2 [] [ Html.text "Keyboard" ]
            , Html.p [] [ Html.text "Escape opens and closes the error overlay, but should be left alone when meant for the page (in an input, or with a popover or modal dialog open)." ]
            , Html.p [] [ Html.input [ Attr.placeholder "Press Escape in here" ] [] ]
            , Html.p [] [ Html.text ("Last pressed keys: " ++ String.join ", " model.lastPressedKeys) ]
            ]
        ]
    }


main : Program () Model Msg
main =
    Browser.document
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }
