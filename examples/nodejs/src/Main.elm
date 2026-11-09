port module Main exposing (main)

{-| A `Platform.worker` program (no view), run by program.js in Node.js.
-}


port fromJs : (String -> msg) -> Sub msg


port toJs : ( String, Int ) -> Cmd msg


type Msg
    = GotMessageFromJs String


type alias Model =
    { count : Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMessageFromJs message ->
            let
                count =
                    model.count + 1
            in
            ( { model | count = count }
            , toJs ( String.toUpper message ++ "!", count )
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    fromJs GotMessageFromJs


main : Program () Model Msg
main =
    Platform.worker
        { init = init
        , update = update
        , subscriptions = subscriptions
        }
