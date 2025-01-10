port module DocumentMain exposing (main)

import Browser
import Browser.Events
import Html
import Html.Attributes as Attr
import Html.Events exposing (onClick)
import Json.Decode as Decode
import Shared


port openModalDialog : () -> Cmd msg


type Msg
    = IncrementClicked
    | DecrementClicked
    | OpenModalDialogClicked
    | PressedKey String


type alias Model =
    { count : Int
    , lastPressedKeys : List String
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      , lastPressedKeys = []
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

        OpenModalDialogClicked ->
            ( model, openModalDialog () )

        PressedKey key ->
            ( { model | lastPressedKeys = key :: model.lastPressedKeys }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions _ =
    Browser.Events.onKeyDown (Decode.field "key" Decode.string |> Decode.map PressedKey)


view : Model -> Browser.Document Msg
view model =
    { title = "Awesome counter app"
    , body =
        [ Html.main_ []
            [ Html.button [ onClick DecrementClicked ]
                [ Html.text Shared.minus ]
            , Html.text (" " ++ String.fromInt model.count ++ " ")
            , Html.button [ onClick IncrementClicked ]
                [ Html.text Shared.plus ]
            , Html.hr [] []
            , Html.button [ Attr.attribute "popovertarget" "popover" ]
                [ Html.text "Open popover" ]
            , Html.p [ Attr.attribute "popover" "auto", Attr.id "popover" ]
                [ Html.text "popover – should be covered by the error display" ]
            , Html.button [ onClick OpenModalDialogClicked ]
                [ Html.text "Open modal dialog" ]
            , Html.node "dialog"
                []
                [ Html.text "modal dialog – should be covered by the error display" ]
            , Html.p
                [ Attr.style "position" "fixed"
                , Attr.style "top" "0"
                , Attr.style "right" "0"
                , Attr.style "background" "red"
                , Attr.style "z-index" "2147483647"
                ]
                [ Html.text "position: fixed with maximum z-index – should be covered by the error overlay" ]
            , Html.hr [] []
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
